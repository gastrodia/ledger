import { cn } from "@/lib/utils";

type Portrait = {
  hair: string;
  behind?: string;
  accessory?: string;
  glasses?: "round" | "square";
  collar?: "shirt" | "round" | "hoodie";
};

// Original portraits share a face and shoulders, with distinct hair and accessories.
// Paths stay intentionally sparse so the family roles remain legible at small sizes.
const portraits: Record<string, Portrait> = {
  father: {
    hair: "M9.5 12V9.5a6.5 6.5 0 0 1 13 0V12M9.5 11.5c3 .2 5.8-1.3 7.5-4 1 2.5 3 3.8 5.5 4",
    collar: "shirt",
  },
  mother: {
    behind: "M9.5 9C6 12 7 20 6 23h6M22.5 9C26 12 25 20 26 23h-6",
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M9.5 12c3-.5 5-2.5 6.5-5 1.5 2.5 3.5 4.5 6.5 5",
    collar: "round",
  },
  grandfather: {
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M9.5 10l2 1M22.5 10l-2 1",
    glasses: "square",
    accessory: "M13 19c1.2-1 2-.8 3 0 1-.8 1.8-1 3 0",
    collar: "shirt",
  },
  grandmother: {
    behind: "M12.5 5.5a3.5 3.5 0 1 1 7 0",
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M9.5 11c2.5 0 4.5-1.5 6.5-4 2 2.5 4 4 6.5 4",
    glasses: "round",
    collar: "round",
  },
  "maternal-grandfather": {
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M10 10c3 1 6-1 8-3M19 8l3 3",
    glasses: "round",
    accessory: "M14 19h4",
    collar: "round",
  },
  "maternal-grandmother": {
    behind: "M9 8c-3 1-3 5-1 6M23 8c3 1 3 5 1 6",
    hair: "M9.5 12V9.5c-1-3 2-5.5 4-4.5 1-2 4-2 5 0 3-1 5 1.5 4 4.5V12M9.5 11c3 0 5-2 6.5-4 1.5 2 3.5 4 6.5 4",
    glasses: "square",
    collar: "round",
  },
  son: {
    hair: "M9.5 12V10c0-4 3-6 6.5-6h2l-1 2c3 0 5.5 2 5.5 5v1M9.5 11l4-2 3 2 2-2 4 3",
    collar: "round",
  },
  daughter: {
    behind: "M9 11C4 10 4 16 5 20l4-3M23 11c5-1 5 5 4 9l-4-3",
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M9.5 11H14V8l3 3h5.5",
    collar: "round",
  },
  "older-brother": {
    hair: "M9.5 12V9.5C9.5 5 13 3 18 4l4.5 3v5M9.5 11c4 0 8-2 10-5M20 9l2.5 3",
    collar: "hoodie",
  },
  "older-sister": {
    behind: "M23 10c5 0 5 6 3 11l-3-4",
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M9.5 11c4 0 6-2 8-5M18 8l4.5 4",
    collar: "round",
  },
  "younger-brother": {
    hair: "M9.5 12V9l3-2-1-3 4 2 3-3 1 4 3 2v3M10 11l3-1 3 1 3-1 3 2",
    collar: "round",
  },
  "younger-sister": {
    behind: "M10 8a3 3 0 1 1 2-3M22 8a3 3 0 1 0-2-3",
    hair: "M9.5 12V10a6.5 6.5 0 0 1 13 0v2M9.5 11h4l2.5-3 2.5 3h4",
    collar: "round",
  },
};

export function FamilyAvatarIcon({ role, className }: { role: string; className?: string }) {
  const portrait = portraits[role] || portraits.father;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("inline-block size-6 shrink-0", className)}
    >
      {portrait.behind && <path d={portrait.behind} />}
      <path d={portrait.hair} />
      <path d="M9.5 12v4a6.5 6.5 0 0 0 13 0v-4M13 22v2M19 22v2M13 24H11a6 6 0 0 0-6 5h22a6 6 0 0 0-6-5h-2" />
      {portrait.glasses === "round" ? (
        <>
          <circle cx="12.5" cy="14.5" r="2.5" />
          <circle cx="19.5" cy="14.5" r="2.5" />
          <path d="M15 14h2" />
        </>
      ) : portrait.glasses === "square" ? (
        <>
          <rect x="10" y="12.5" width="5" height="4" rx="1" />
          <rect x="17" y="12.5" width="5" height="4" rx="1" />
          <path d="M15 14h2" />
        </>
      ) : (
        <>
          <circle cx="13" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
          <circle cx="19" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
        </>
      )}
      {portrait.accessory ? <path d={portrait.accessory} /> : <path d="M14 18.5q2 1.5 4 0" />}
      {portrait.collar === "shirt" ? (
        <path d="m13 24 3 3 3-3M16 27v2" />
      ) : portrait.collar === "hoodie" ? (
        <path d="m11 24 2 4h6l2-4" />
      ) : (
        <path d="M13 24q3 4 6 0" />
      )}
    </svg>
  );
}
