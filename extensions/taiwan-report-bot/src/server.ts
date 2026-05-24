import "dotenv/config";
import { startApiServer } from "./api/server.js";

const port = Number(process.env.HTTP_PORT ?? 8787);

startApiServer(port).catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});
