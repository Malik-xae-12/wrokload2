import React, { useEffect, useRef } from "react";
import { PageProps } from "../../App";
import "./HelloWorldItem.scss";

export function HelloWorldItemEditor(props: PageProps) {
  const { workloadClient } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === "FABRIC_SIGN_IN_REQUEST") {
        console.log("📨 Received FABRIC_SIGN_IN_REQUEST from Accelerator iframe");
        try {
          let token: string | null = null;
          const authAny = workloadClient.auth as any;

          // Strategy 1: acquireFrontendAccessToken with Fabric default scope
          if (!token && typeof authAny?.acquireFrontendAccessToken === "function") {
            try {
              const res = await authAny.acquireFrontendAccessToken({
                scopes: ["https://api.fabric.microsoft.com/.default"]
              });
              if (res?.token) {
                token = res.token;
                console.log("🔑 Acquired user token via acquireFrontendAccessToken (Fabric scope)");
              }
            } catch (e: any) {
              console.warn("acquireFrontendAccessToken Fabric scope:", e?.message || e);
            }
          }

          // Strategy 2: acquireFrontendAccessToken with empty scopes
          if (!token && typeof authAny?.acquireFrontendAccessToken === "function") {
            try {
              const res = await authAny.acquireFrontendAccessToken({ scopes: [] });
              if (res?.token) {
                token = res.token;
                console.log("🔑 Acquired user token via acquireFrontendAccessToken (empty scopes)");
              }
            } catch (e: any) {
              console.warn("acquireFrontendAccessToken empty scopes:", e?.message || e);
            }
          }

          // Strategy 3: acquireAccessToken (Workload Audience)
          if (!token && typeof authAny?.acquireAccessToken === "function") {
            try {
              const res = await authAny.acquireAccessToken({});
              if (res?.token) {
                token = res.token;
                console.log("🔑 Acquired user token via acquireAccessToken");
              }
            } catch (e: any) {
              console.warn("acquireAccessToken:", e?.message || e);
            }
          }

          // Strategy 4: getAccessToken (Direct AAD user session token)
          if (!token && typeof authAny?.getAccessToken === "function") {
            try {
              const res = await authAny.getAccessToken();
              if (res?.token) {
                token = res.token;
                console.log("🔑 Acquired user token via getAccessToken");
              }
            } catch (e: any) {
              console.warn("getAccessToken:", e?.message || e);
            }
          }

          if (token && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
              { type: "FABRIC_SIGN_IN_RESPONSE", token },
              "*"
            );
            console.log("✅ User token sent to Accelerator iframe successfully");
          } else {
            throw new Error("Unable to extract user token from Fabric session. Backend will handle authentication.");
          }
        } catch (error: any) {
          console.error("❌ Fabric token acquisition note:", error);
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage(
              {
                type: "FABRIC_SIGN_IN_ERROR",
                error: error?.message || "Token not available from Fabric session"
              },
              "*"
            );
          }
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [workloadClient]);

  const getUiUrl = () => {
    // 1. If explicit environment FRONTEND_URL is set, use it
    if (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost:60006")) {
      return process.env.FRONTEND_URL;
    }
    // 2. If running locally in browser
    if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
      return "http://localhost:5173/";
    }
    // 3. Production Azure App Service fallback
    return "https://fabric-solution-accelerator.azurewebsites.net/";
  };

  return (
    <div style={{ width: '100%', height: 'calc(100vh - 40px)', minHeight: '800px', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <iframe
        ref={iframeRef}
        src={getUiUrl()}
        title="Fabric Solution Accelerator"
        allow="camera; microphone; geolocation; popups; popups-to-escape-sandbox"
        style={{
          width: '100%',
          height: '100%',
          minHeight: '800px',
          border: 'none',
          flex: 1,
          display: 'block',
        }}
      />
    </div>
  );
}
