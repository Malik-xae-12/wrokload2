"""Automated Microsoft Fabric Workspace, Lakehouse, and Metadata Warehouse provisioner
using Microsoft Entra ID Service Principal and Fabric REST APIs.
Automatically assigns Admin permissions to both the Service Principal and User on creation.
"""

import os
import logging
import time
from concurrent.futures import ThreadPoolExecutor
import httpx
import jwt as pyjwt
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

FABRIC_API_BASE = "https://api.fabric.microsoft.com/v1"
LOGIN_BASE = "https://login.microsoftonline.com"
_TIMEOUT = httpx.Timeout(45.0, connect=10.0)

# Default admin user Object ID
DEFAULT_USER_OBJECT_ID = "58f505c6-d389-468b-9457-cf50c4a45493"


class ProvisionWorkspaceRequest(BaseModel):
    tenant_id: str = Field(..., description="Azure AD / Entra ID Tenant ID")
    client_id: str = Field(..., description="Service Principal App Registration Client ID")
    client_secret: str = Field(..., description="Service Principal Client Secret")
    workspace_name: str = Field("Data_Migration_Workspace", description="Name of the Fabric workspace to create")
    capacity_id: str | None = Field(None, description="Optional Fabric Capacity ID GUID")
    lakehouse_name: str = Field("LH_BRONZE", description="Name of Lakehouse to create")
    warehouse_name: str = Field("WH_METADATA", description="Name of Metadata Warehouse to create")
    user_object_id: str | None = Field(
        DEFAULT_USER_OBJECT_ID,
        description="Azure AD User Object ID to automatically grant Admin access",
    )


class ProvisionWorkspaceResponse(BaseModel):
    success: bool
    message: str
    workspace_id: str | None = None
    workspace_name: str | None = None
    lakehouse_id: str | None = None
    lakehouse_name: str | None = None
    warehouse_id: str | None = None
    warehouse_name: str | None = None
    sql_endpoint: str | None = None
    capacity_assigned: bool = False
    admin_assigned: bool = False


def get_fabric_sp_token(tenant_id: str, client_id: str, client_secret: str) -> str:
    """Acquire OAuth2 bearer token for Microsoft Fabric REST APIs using Service Principal."""
    url = f"{LOGIN_BASE}/{tenant_id.strip()}/oauth2/v2.0/token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": client_id.strip(),
        "client_secret": client_secret.strip(),
        "scope": "https://api.fabric.microsoft.com/.default",
    }
    resp = httpx.post(url, data=payload, timeout=_TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(
            f"Failed to acquire Fabric token: {resp.status_code} - {resp.text}"
        )
    data = resp.json()
    return data["access_token"]


def _get_sp_object_id_from_token(token: str) -> str | None:
    """Extract object ID of the Service Principal from token claims."""
    try:
        claims = pyjwt.decode(token, options={"verify_signature": False})
        return claims.get("oid")
    except Exception:
        return None


def list_existing_workspaces(token: str) -> list[dict]:
    """Retrieve list of workspaces visible to the Service Principal."""
    url = f"{FABRIC_API_BASE}/workspaces"
    headers = {"Authorization": f"Bearer {token}"}
    resp = httpx.get(url, headers=headers, timeout=_TIMEOUT)
    if resp.status_code == 200:
        return resp.json().get("value", [])
    return []


def create_fabric_workspace(token: str, display_name: str, capacity_id: str | None = None) -> dict:
    """Create a new Fabric workspace, or return existing if conflict."""
    url = f"{FABRIC_API_BASE}/workspaces"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload: dict = {"displayName": display_name}
    if capacity_id:
        payload["capacityId"] = capacity_id.strip()

    resp = httpx.post(url, headers=headers, json=payload, timeout=_TIMEOUT)
    if resp.status_code == 201:
        return resp.json()

    # Check if already exists
    workspaces = list_existing_workspaces(token)
    for ws in workspaces:
        if ws.get("displayName", "").lower() == display_name.lower():
            return ws

    raise RuntimeError(f"Failed to create workspace '{display_name}': {resp.status_code} - {resp.text}")


def assign_capacity_to_workspace(token: str, workspace_id: str, capacity_id: str) -> bool:
    """Assign Fabric capacity to workspace."""
    url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/assignToCapacity"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"capacityId": capacity_id.strip()}
    resp = httpx.post(url, headers=headers, json=payload, timeout=_TIMEOUT)
    return resp.status_code in (200, 202)


def add_workspace_admin_role(
    token: str,
    workspace_id: str,
    principal_id: str,
    principal_type: str = "User",
    role: str = "Admin",
) -> bool:
    """Assign Admin role to user or service principal on the workspace."""
    url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/roleAssignments"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "principal": {
            "id": principal_id.strip(),
            "type": principal_type,
        },
        "role": role,
    }
    resp = httpx.post(url, headers=headers, json=payload, timeout=_TIMEOUT)
    if resp.status_code in (200, 201, 409):
        return True
    logger.warning(f"Role assignment response for {principal_id}: {resp.status_code} - {resp.text}")
    return False


def get_workspace_role_assignments(token: str, workspace_id: str) -> list[dict]:
    """Retrieve all role assignments for a workspace."""
    url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/roleAssignments"
    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = httpx.get(url, headers=headers, timeout=httpx.Timeout(10.0, connect=5.0))
        if resp.status_code == 200:
            return resp.json().get("value", [])
    except Exception as e:
        logger.warning(f"Failed to fetch role assignments for workspace {workspace_id}: {e}")
    return []


def list_user_workspaces(
    tenant_id: str,
    client_id: str,
    client_secret: str,
    user_object_id: str,
    allowed_roles: list[str] | None = None,
) -> list[dict]:
    """
    List all Fabric workspaces where the given user_object_id has Member, Admin, or Contributor access.
    """
    if allowed_roles is None:
        allowed_roles = ["Admin", "Member", "Contributor"]
    allowed_roles_lower = [r.strip().lower() for r in allowed_roles]

    token = get_fabric_sp_token(tenant_id, client_id, client_secret)
    all_workspaces = list_existing_workspaces(token)
    user_oid_clean = user_object_id.strip().lower()

    user_accessible_workspaces = []

    def check_workspace(ws: dict) -> dict | None:
        ws_id = ws.get("id")
        if not ws_id:
            return None
        roles = get_workspace_role_assignments(token, ws_id)
        for r in roles:
            principal = r.get("principal", {})
            p_id = str(principal.get("id", "")).strip().lower()
            role_name = r.get("role", "")
            if p_id == user_oid_clean and role_name.lower() in allowed_roles_lower:
                return {
                    "id": ws_id,
                    "displayName": ws.get("displayName", ""),
                    "description": ws.get("description", ""),
                    "capacityId": ws.get("capacityId", ""),
                    "userRole": role_name,
                }
        return None

    with ThreadPoolExecutor(max_workers=6) as executor:
        results = executor.map(check_workspace, all_workspaces)
        for res in results:
            if res:
                user_accessible_workspaces.append(res)

    return user_accessible_workspaces


def list_workspace_items(token: str, workspace_id: str) -> list[dict]:
    """List all items (Lakehouses, Warehouses, Notebooks) in workspace."""
    url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/items"
    headers = {"Authorization": f"Bearer {token}"}
    resp = httpx.get(url, headers=headers, timeout=_TIMEOUT)
    if resp.status_code == 200:
        return resp.json().get("value", [])
    return []


def create_fabric_item(
    token: str,
    workspace_id: str,
    item_type: str,
    display_name: str,
    description: str = "",
    schema_enabled: bool = True,
    existing_items: list[dict] | None = None,
) -> dict:
    """Create a Lakehouse or Warehouse in the workspace."""
    if existing_items is None:
        existing_items = list_workspace_items(token, workspace_id)

    for itm in existing_items:
        if itm.get("displayName", "").lower() == display_name.lower() and itm.get("type", "").lower() == item_type.lower():
            return itm

    url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/items"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    formatted_type = "Lakehouse" if item_type.lower() == "lakehouse" else "Warehouse"
    payload: dict = {
        "displayName": display_name,
        "type": formatted_type,
        "description": description,
    }
    if formatted_type == "Lakehouse" and schema_enabled:
        payload["creationPayload"] = {"enableSchemas": True}

    resp = httpx.post(url, headers=headers, json=payload, timeout=_TIMEOUT)
    if resp.status_code in (200, 201):
        return resp.json()

    if resp.status_code == 202:
        for _ in range(8):
            time.sleep(0.5)
            items = list_workspace_items(token, workspace_id)
            for itm in items:
                if itm.get("displayName", "").lower() == display_name.lower():
                    return itm
        return {"displayName": display_name, "type": formatted_type, "id": None}

    raise RuntimeError(f"Failed to create {formatted_type} '{display_name}': {resp.status_code} - {resp.text}")


def get_sql_analytics_endpoint(token: str, workspace_id: str, lakehouse_id: str | None = None, warehouse_id: str | None = None) -> str | None:
    """Retrieve SQL Analytics connection string for Lakehouse or Warehouse."""
    headers = {"Authorization": f"Bearer {token}"}
    if warehouse_id:
        try:
            url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/warehouses/{warehouse_id}"
            resp = httpx.get(url, headers=headers, timeout=httpx.Timeout(10.0, connect=5.0))
            if resp.status_code == 200:
                props = resp.json().get("properties", {})
                conn_str = props.get("connectionInfo") or props.get("connectionString")
                if conn_str:
                    return conn_str
        except Exception:
            pass

    if lakehouse_id:
        try:
            url = f"{FABRIC_API_BASE}/workspaces/{workspace_id}/lakehouses/{lakehouse_id}"
            resp = httpx.get(url, headers=headers, timeout=httpx.Timeout(10.0, connect=5.0))
            if resp.status_code == 200:
                props = resp.json().get("properties", {})
                conn_str = props.get("sqlEndpointProperties", {}).get("connectionString") or props.get("connectionInfo")
                if conn_str:
                    return conn_str
        except Exception:
            pass
    return None


def auto_provision_fabric_environment(req: ProvisionWorkspaceRequest) -> ProvisionWorkspaceResponse:
    """Executes the full automated setup of Fabric Workspace, Lakehouse, Warehouse, and automatically
    assigns Admin access to both the Service Principal and the user in parallel.
    """
    try:
        token = get_fabric_sp_token(req.tenant_id, req.client_id, req.client_secret)

        # 1. Create Workspace
        ws = create_fabric_workspace(token, req.workspace_name, req.capacity_id)
        ws_id = ws["id"]
        ws_name = ws.get("displayName", req.workspace_name)

        # 2. Assign Capacity if provided
        capacity_assigned = False
        if req.capacity_id:
            capacity_assigned = assign_capacity_to_workspace(token, ws_id, req.capacity_id)

        # 3. Automatically assign Admin access to Service Principal & User in parallel
        sp_oid = _get_sp_object_id_from_token(token)
        user_oid = req.user_object_id or DEFAULT_USER_OBJECT_ID
        admin_assigned = False

        with ThreadPoolExecutor(max_workers=4) as executor:
            fut_sp = executor.submit(add_workspace_admin_role, token, ws_id, sp_oid, "ServicePrincipal", "Admin") if sp_oid else None
            fut_user = executor.submit(add_workspace_admin_role, token, ws_id, user_oid, "User", "Admin") if user_oid else None

            # 4. Create Lakehouse (LH_BRONZE) & Warehouse (WH_METADATA) in parallel
            existing_items = list_workspace_items(token, ws_id)
            fut_lh = executor.submit(
                create_fabric_item, token, ws_id, "Lakehouse", req.lakehouse_name,
                "Lakehouse for raw and staged tables", True, existing_items
            )
            fut_wh = executor.submit(
                create_fabric_item, token, ws_id, "Warehouse", req.warehouse_name,
                "Warehouse for metadata, logging, and transformed tables", False, existing_items
            )

            if fut_user:
                admin_assigned = fut_user.result()

            lh = fut_lh.result()
            wh = fut_wh.result()

        lh_id = lh.get("id")
        lh_name = lh.get("displayName", req.lakehouse_name)
        wh_id = wh.get("id")
        wh_name = wh.get("displayName", req.warehouse_name)

        # 5. Fetch SQL endpoint
        sql_endpoint = get_sql_analytics_endpoint(token, ws_id, lh_id, wh_id)
        if not sql_endpoint:
            sql_endpoint = os.getenv("FABRIC_SQL_ENDPOINT") or f"{ws_id}.datawarehouse.fabric.microsoft.com"

        return ProvisionWorkspaceResponse(
            success=True,
            message=f"Workspace '{ws_name}', Lakehouse '{lh_name}', and Warehouse '{wh_name}' successfully provisioned with Admin access granted.",
            workspace_id=ws_id,
            workspace_name=ws_name,
            lakehouse_id=lh_id,
            lakehouse_name=lh_name,
            warehouse_id=wh_id,
            warehouse_name=wh_name,
            sql_endpoint=sql_endpoint,
            capacity_assigned=capacity_assigned,
            admin_assigned=admin_assigned,
        )
    except Exception as e:
        logger.exception("Error auto-provisioning Fabric workspace")
        return ProvisionWorkspaceResponse(
            success=False,
            message=f"Provisioning failed: {str(e)}",
        )
