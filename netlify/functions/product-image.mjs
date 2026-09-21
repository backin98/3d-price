import store from "../../lib/netlify-store.cjs";

const { readBytes } = store;

function imageType(bytes) {
  if (!bytes || bytes.length < 12) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes.slice(1, 4).toString() === "PNG") return "image/png";
  if (bytes.slice(0, 4).toString() === "RIFF" && bytes.slice(8, 12).toString() === "WEBP") return "image/webp";
  return "";
}

export default async (req) => {
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!/^[a-z0-9._-]+$/i.test(key)) return new Response("Invalid image", { status: 400 });
  const bytes = await readBytes("product-images/" + key);
  const type = imageType(bytes);
  if (!type) return new Response("Image not found", { status: 404 });
  return new Response(bytes, {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" }
  });
};
