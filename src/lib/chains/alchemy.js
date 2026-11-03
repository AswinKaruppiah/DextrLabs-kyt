/** Alchemy network host per EVM chain id. */
export const ALCHEMY_NETWORKS = { ETHEREUM: "eth-mainnet", BSC: "bnb-mainnet" };

/** JSON-RPC URL for a chain; throws when the Alchemy key is missing. */
export function alchemyUrl(chain) {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) throw new Error("ALCHEMY_API_KEY is not set — needed for Ethereum / BSC transfer history");
  return `https://${ALCHEMY_NETWORKS[chain]}.g.alchemy.com/v2/${key}`;
}
