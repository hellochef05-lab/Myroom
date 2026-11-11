const configuredClients = new WeakSet();
export const MESSAGE_REQUEST_TIMEOUT_MS = 6000;

export function configureFastMessageRequests(client) {
  if (configuredClients.has(client)) return client;
  client.axiosInstance.interceptors.request.use(config => {
    // Bound only message creation. Large uploads and history queries keep
    // their SDK timeouts, and retries retain the original message ID.
    if (String(config.method).toLowerCase() === 'post' &&
        /\/channels\/[^/]+\/[^/]+\/message(?:\?.*)?$/.test(String(config.url))) {
      const existing = Number(config.timeout);
      config.timeout = existing > 0
        ? Math.min(existing, MESSAGE_REQUEST_TIMEOUT_MS)
        : MESSAGE_REQUEST_TIMEOUT_MS;
    }
    return config;
  });
  configuredClients.add(client);
  return client;
}
