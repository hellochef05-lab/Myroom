export default function handler(request, response) {
  const getHeader = (name) => String(request.headers?.[name] || "").trim();
  const countryCode = getHeader("x-vercel-ip-country").toUpperCase();

  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Vary", "x-vercel-ip-country, x-vercel-ip-timezone");
  response.status(200).json({
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : "",
    timezone: getHeader("x-vercel-ip-timezone"),
  });
}
