export { detectHostEnvironment, isInHost, isInHostAsync, type HostEnvironment } from "./detect.ts";
export { connectToHost, isHostConnected, getAccountsProvider } from "./connection.ts";
export {
    getPaseoAssetHubClient,
    resetClients,
    PASEO_ASSET_HUB_GENESIS,
    PASEO_ASSET_HUB_WS,
} from "./provider.ts";
export { getHostAccounts, subscribeHostAccounts, type HostAccount } from "./accounts.ts";
export { claimDefaultAllowances } from "./allowances.ts";
