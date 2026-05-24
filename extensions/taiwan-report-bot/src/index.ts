import { startApiServer } from "./api/server.js";
import { createBot } from "./bot.js";

const RUN = (process.env.RUN ?? "bot,api").split(",").map((s) => s.trim());

async function main(): Promise<void> {
  if (RUN.includes("bot")) {
    const bot = createBot();
    await bot.launch();
    console.log("✅ Taiwan violation reporting Telegram bot launched");
    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  }
  if (RUN.includes("api")) {
    const port = Number(process.env.HTTP_PORT ?? 8787);
    await startApiServer(port);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
