import { cloudRepository } from "../cloud/cloudRepository.js";
import { localRepository } from "./localRepository.js";
import { hasRepositoryContract } from "./repositoryContract.js";

/**
 * Repository mode is an explicit caller choice. Authentication state never
 * changes the default or silently moves application reads to the cloud.
 */
export function createRepository({ mode = "local" } = {}) {
  if (mode === "local") return localRepository;
  if (mode === "cloud") return cloudRepository;
  throw new Error(`Unsupported Winter Arc repository mode: ${mode}`);
}

export function getRepository(options = {}) {
  return createRepository(options);
}

export { hasRepositoryContract };

export const defaultRepository = createRepository();
