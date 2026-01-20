import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
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
          borderRadius: 112,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* shine */}
        <div
          style={{
            position: "absolute",
            width: 520,
            height: 520,
            left: -120,
            top: -160,
            background:
              "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 60%)",
          }}
        />

        {/* book */}
        <div
          style={{
            width: 300,
            height: 340,
            borderRadius: 56,
            backgroundColor: "rgba(255,255,255,0.92)",
            display: "flex",
            position: "relative",
            boxShadow: "0 24px 60px rgba(0,0,0,0.18)",
          }}
        >
          <div
            style={{
              width: 16,
              height: 276,
              borderRadius: 8,
              backgroundColor: "rgba(99,102,241,0.30)",
              position: "absolute",
              left: 34,
              top: 32,
            }}
          />

          {/* lines */}
          <div
            style={{
              position: "absolute",
              left: 72,
              top: 78,
              width: 160,
              height: 14,
              backgroundColor: "rgba(99,102,241,0.50)",
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 72,
              top: 130,
              width: 134,
              height: 14,
              backgroundColor: "rgba(99,102,241,0.40)",
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 72,
              top: 182,
              width: 150,
              height: 14,
              backgroundColor: "rgba(99,102,241,0.32)",
              borderRadius: 999,
            }}
          />

          {/* coin */}
          <div
            style={{
              position: "absolute",
              right: -26,
              top: 54,
              width: 132,
              height: 132,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.96)",
              boxShadow: "0 14px 34px rgba(0,0,0,0.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 12,
                height: 80,
                borderRadius: 999,
                backgroundColor: "#6366f1",
                position: "absolute",
              }}
            />
            <div
              style={{
                width: 78,
                height: 12,
                borderRadius: 999,
                backgroundColor: "#6366f1",
                position: "absolute",
                top: 40,
              }}
            />
            <div
              style={{
                width: 78,
                height: 12,
                borderRadius: 999,
                backgroundColor: "#6366f1",
                position: "absolute",
                bottom: 40,
              }}
            />
          </div>
        </div>
      </div>
    ),
    size
  );
}

