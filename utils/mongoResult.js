export function unwrapFindOneAndUpdateResult(result) {
  if (!result) return null;
  return result?.value ?? result;
}
