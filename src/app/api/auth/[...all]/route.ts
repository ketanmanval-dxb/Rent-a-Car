import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

// Better Auth endpoints: /api/auth/sign-up/email, /api/auth/sign-in/email, /api/auth/sign-out, /api/auth/get-session ...
export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler((request: Request) => getAuth().handler(request));
