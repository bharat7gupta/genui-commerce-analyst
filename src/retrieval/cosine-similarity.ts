export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dotProduct = 0;
  let leftSquaredMagnitude = 0;
  let rightSquaredMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dotProduct += leftValue * rightValue;
    leftSquaredMagnitude += leftValue * leftValue;
    rightSquaredMagnitude += rightValue * rightValue;
  }

  const denominator =
    Math.sqrt(leftSquaredMagnitude) * Math.sqrt(rightSquaredMagnitude);
  if (denominator === 0) {
    throw new Error("Cannot compute cosine similarity for a zero vector");
  }

  return dotProduct / denominator;
}
