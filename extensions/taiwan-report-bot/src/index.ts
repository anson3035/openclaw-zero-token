import { createBot } from "./bot.js";

async function main(): Promise<void> {
  const bot = createBot();
  await bot.launch();
  console.log("✅ Taiwan violation reporting bot launched");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
