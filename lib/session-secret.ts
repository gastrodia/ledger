const secret = process.env.JWT_SECRET;

if (!secret?.trim()) {
  throw new Error("JWT_SECRET environment variable is required");
}

export const sessionSecret = new TextEncoder().encode(secret);
