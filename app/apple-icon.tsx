import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #4f46e5 0%, #6366f1 55%, #a855f7 100%)",
          borderRadius: 40,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 220,
            height: 220,
            left: -40,
            top: -60,
            background:
              "radial-gradient(circle at 35% 35%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 65%)",
          }}
        />

        <div
          style={{
            width: 112,
            height: 124,
            borderRadius: 24,
            backgroundColor: "rgba(255,255,255,0.92)",
            display: "flex",
            position: "relative",
            boxShadow: "0 10px 22px rgba(0,0,0,0.18)",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 14,
              top: 12,
              width: 6,
              height: 98,
              borderRadius: 999,
              backgroundColor: "rgba(99,102,241,0.28)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 30,
              top: 28,
              width: 54,
              height: 6,
              borderRadius: 999,
              backgroundColor: "rgba(99,102,241,0.48)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 30,
              top: 46,
              width: 46,
              height: 6,
              borderRadius: 999,
              backgroundColor: "rgba(99,102,241,0.38)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 30,
              top: 64,
              width: 52,
              height: 6,
              borderRadius: 999,
              backgroundColor: "rgba(99,102,241,0.30)",
            }}
          />

          <div
            style={{
              position: "absolute",
              right: -12,
              top: 20,
              width: 48,
              height: 48,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.96)",
              boxShadow: "0 6px 14px rgba(0,0,0,0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 8,
              top: 26,
              width: 6,
              height: 36,
              borderRadius: 999,
              backgroundColor: "#6366f1",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -1,
              top: 34,
              width: 28,
              height: 6,
              borderRadius: 999,
              backgroundColor: "#6366f1",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: -1,
              top: 50,
              width: 28,
              height: 6,
              borderRadius: 999,
              backgroundColor: "#6366f1",
            }}
          />
        </div>
      </div>
    ),
    size
  );
}

