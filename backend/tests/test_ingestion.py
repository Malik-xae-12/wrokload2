import unittest
from app.modules.fabric.services.ingestion_service import (
    _map_sql_type,
    _compute_hash_key,
    CREATED_KEYWORDS,
    UPDATED_KEYWORDS,
)
from app.modules.fabric.services.fabric_provisioner import (
    ProvisionWorkspaceRequest,
)


class TestIngestionLogic(unittest.TestCase):
    def test_map_sql_types(self):
        self.assertEqual(_map_sql_type("varchar", 50, None, None), "VARCHAR(50)")
        self.assertEqual(_map_sql_type("nvarchar", -1, None, None), "VARCHAR(MAX)")
        self.assertEqual(_map_sql_type("decimal", None, 18, 4), "DECIMAL(18, 4)")
        self.assertEqual(_map_sql_type("int", None, None, None), "INT")
        self.assertEqual(_map_sql_type("bigint", None, None, None), "BIGINT")
        self.assertEqual(_map_sql_type("datetime2", None, None, None), "DATETIME2(6)")
        self.assertEqual(_map_sql_type("date", None, None, None), "DATE")

    def test_compute_hash_key(self):
        vals1 = [101, "Alice", "2026-08-20 10:00:00"]
        vals2 = [101, "Alice", "2026-08-20 10:00:00"]
        vals3 = [101, "Alice Cooper", "2026-08-20 10:00:00"]

        hash1 = _compute_hash_key(vals1)
        hash2 = _compute_hash_key(vals2)
        hash3 = _compute_hash_key(vals3)

        self.assertEqual(hash1, hash2)
        self.assertNotEqual(hash1, hash3)
        self.assertEqual(len(hash1), 32)

    def test_notebook_incremental_partitioning(self):
        target_map = {
            1: _compute_hash_key([1, "Item A", 100]),
            2: _compute_hash_key([2, "Item B", 200]),
        }

        source_rows = [
            {"id": 1, "name": "Item A", "price": 100},
            {"id": 2, "name": "Item B", "price": 250},
            {"id": 3, "name": "Item C", "price": 300},
        ]

        inserted = []
        updated = []
        unchanged = []

        for row in source_rows:
            pk = row["id"]
            h = _compute_hash_key(list(row.values()))
            if pk not in target_map:
                inserted.append(row)
            elif target_map[pk] != h:
                updated.append(row)
            else:
                unchanged.append(row)

        self.assertEqual(len(inserted), 1)
        self.assertEqual(inserted[0]["id"], 3)

        self.assertEqual(len(updated), 1)
        self.assertEqual(updated[0]["id"], 2)

        self.assertEqual(len(unchanged), 1)
        self.assertEqual(unchanged[0]["id"], 1)

    def test_keyword_matching(self):
        cols = ["OrderID", "CustomerID", "OrderDate", "Created_At", "Modified_Date"]
        updated_col = None
        created_col = None

        for col in cols:
            low = col.lower().replace(" ", "").replace("_", "")
            if not updated_col and any(h.replace("_", "") in low for h in UPDATED_KEYWORDS):
                updated_col = col
            elif not created_col and any(h.replace("_", "") in low for h in CREATED_KEYWORDS):
                created_col = col

        self.assertEqual(updated_col, "Modified_Date")
        self.assertEqual(created_col, "Created_At")

    def test_dual_watermark_determination(self):
        updated_col = "updated_at"
        created_col = "created_at"
        row1 = {"updated_at": "2026-08-26 12:00:00", "created_at": "2026-08-20 10:00:00"}
        row2 = {"updated_at": None, "created_at": "2026-08-25 10:00:00"}

        wm1 = row1[updated_col] or row1[created_col]
        wm2 = row2[updated_col] or row2[created_col]

        self.assertEqual(wm1, "2026-08-26 12:00:00")
        self.assertEqual(wm2, "2026-08-25 10:00:00")
        self.assertEqual(max(wm1, wm2), "2026-08-26 12:00:00")

    def test_provision_request_validation(self):
        req = ProvisionWorkspaceRequest(
            tenant_id="f45de27c-093c-413b-be2d-a2a92f98cf24",
            client_id="fbdd0ef6-296b-48a0-b07b-b23d6a2ad44b",
            client_secret="test-secret",
            workspace_name="Test_Workspace",
            lakehouse_name="LH_BRONZE",
            warehouse_name="WH_METADATA",
        )
        self.assertEqual(req.workspace_name, "Test_Workspace")
        self.assertEqual(req.lakehouse_name, "LH_BRONZE")


if __name__ == "__main__":
    unittest.main()

