/**
 * PDF 報告書產生 — 用於正式送件給承辦機關
 *
 * 為何需要 PDF（不只 email body）：
 *   - 部分機關公文系統偏好 PDF 附件而非純文字
 *   - PDF 可嵌入照片，視覺證據與文字證據並列
 *   - 加 SHA-256 與時間戳記作為文件指紋
 *
 * 不用 puppeteer / chromium 而用 pdfkit：
 *   - 包大小小（~ 3MB vs ~150MB）
 *   - 無需 GPU / display
 *   - 純 Node，跨平台
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import PDFDocument from "pdfkit";
import type { MediaEvidence, ReportArtifact, ReportContext } from "../types.js";

// 嘗試載入系統中文字體（macOS / Linux）。失敗則使用 Helvetica（中文會顯示□）
const FONT_CANDIDATES = [
  "/System/Library/Fonts/PingFang.ttc", // macOS
  "/Library/Fonts/Songti.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", // Ubuntu
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
  "C:\\Windows\\Fonts\\msjh.ttc", // Windows 微軟正黑體
];

async function resolveFont(): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  for (const p of FONT_CANDIDATES) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* not found, try next */
    }
  }
  return undefined;
}

export interface PdfOptions {
  /** 包含照片 attachment（首張） */
  includeImage?: boolean;
}

/**
 * 產生 PDF 報告書到指定路徑。
 *
 * Returns 寫入完成之 path。
 */
export async function generateReportPdf(
  artifact: ReportArtifact,
  ctx: ReportContext,
  outputPath: string,
  options: PdfOptions = {},
): Promise<string> {
  await mkdir(dirname(outputPath), { recursive: true });
  const fontPath = await resolveFont();

  return new Promise<string>(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 50,
        info: {
          Title: artifact.emailSubject,
          Author: ctx.reporter?.name ?? "anonymous",
          Subject: `違規檢舉報告書 ${artifact.trackingId}`,
          Creator: "violation-bot v4.4",
        },
      });
      const stream = createWriteStream(outputPath);
      doc.pipe(stream);

      if (fontPath) doc.font(fontPath);

      // ===== Header =====
      doc
        .fontSize(20)
        .text("違規檢舉報告書", { align: "center" })
        .moveDown(0.3)
        .fontSize(9)
        .fillColor("gray")
        .text(`內部追蹤號：${artifact.trackingId}（非主管機關官方受文號）`, {
          align: "center",
        })
        .moveDown(1)
        .fillColor("black");

      // ===== Body — 把 markdown 轉純文字（去掉 ** ` 等標記） =====
      const plain = artifact.markdown
        .replace(/^#{1,6}\s+/gm, "") // remove heading markers
        .replace(/\*\*(.+?)\*\*/g, "$1") // bold
        .replace(/`([^`]+)`/g, "$1") // code
        .replace(/^>\s+/gm, "") // blockquote
        .replace(/^\s*[-•]\s+/gm, "• ") // list
        .replace(/\n{3,}/g, "\n\n"); // collapse blanks

      doc.fontSize(10).text(plain, { lineGap: 4 });
      doc.moveDown(1);

      // ===== SHA-256 fingerprints =====
      doc
        .fontSize(8)
        .fillColor("gray")
        .text("證據雜湊（供機關驗證未經竄改）：", { underline: true })
        .fillColor("black");
      for (const e of ctx.evidence) {
        doc.text(`  ${e.sha256}`, { lineGap: 2 });
      }
      doc.moveDown(0.5);

      // ===== Image embed =====
      if (options.includeImage !== false && ctx.evidence[0]) {
        try {
          doc.addPage();
          doc.fontSize(14).text("附件：違規現場影像", { align: "center" }).moveDown(0.5);
          const imgBuf = await readFile(ctx.evidence[0].filePath);
          doc.image(imgBuf, {
            fit: [500, 700],
            align: "center",
          });
          doc
            .moveDown(0.5)
            .fontSize(8)
            .fillColor("gray")
            .text(`SHA-256: ${ctx.evidence[0].sha256}`, { align: "center" });
        } catch (err) {
          doc.text(`(影像嵌入失敗：${(err as Error).message})`);
        }
      }

      // ===== Footer =====
      doc
        .fontSize(8)
        .fillColor("gray")
        .text(`產生時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`, 50, doc.page.height - 60);

      doc.end();
      stream.on("finish", () => resolve(outputPath));
      stream.on("error", reject);
    } catch (err) {
      reject(err);
    }
  });
}
