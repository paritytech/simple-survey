/**
 * Host environment detection — thin wrapper around `@parity/product-sdk/host`.
 *
 * We delegate to the SDK rather than maintaining our own iframe / webview-mark
 * heuristics so this app stays consistent with t3rminal (same SDK detection)
 * and picks up signals like the product-sdk sandbox handshake.
 */

import { isInsideContainerSync } from "@parity/product-sdk/host";

export type HostEnvironment = "desktop-webview" | "web-iframe" | "standalone";

export function detectHostEnvironment(): HostEnvironment {
    if (typeof window === "undefined") return "standalone";

    if (!isInsideContainerSync()) return "standalone";

    // Inside a container — disambiguate desktop webview vs web iframe.
    if ((window as { __HOST_WEBVIEW_MARK__?: boolean }).__HOST_WEBVIEW_MARK__ === true) {
        return "desktop-webview";
    }
    return "web-iframe";
}

export function isInHost(): boolean {
    return isInsideContainerSync();
}

/**
 * Async variant — also performs the product-sdk sandbox handshake. Use this
 * when you can afford an await and need the strongest detection (e.g., during
 * app boot before triggering host-only flows).
 */
export { isInsideContainer as isInHostAsync } from "@parity/product-sdk/host";
