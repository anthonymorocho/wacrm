/**
 * Resolve the browser-visible origin for provider callbacks.
 *
 * Hosting adapters can expose an internal request URL such as
 * `http://0.0.0.0/...` while the CRM is publicly reachable at the configured
 * site URL. OAuth callbacks must always return to the public origin.
 */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  const host = forwardedHost || request.headers.get('host')?.trim();
  if (host) {
    const forwardedProto = request.headers
      .get('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim();
    return `${forwardedProto || new URL(request.url).protocol.replace(':', '')}://${host}`;
  }

  return new URL(request.url).origin;
}
