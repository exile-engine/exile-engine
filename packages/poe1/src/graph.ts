import { errorDiagnostic, failure, success, type Result } from '@exile-engine/core';

export type CalculationDependencies = Readonly<Record<string, readonly string[]>>;

/**
 * Plan only graphs whose semantics are acyclic. Feedback is an explicit unsupported
 * rule: no arbitrary iteration count, previous-value fallback or invented fixed point.
 */
export function planCalculationGraph(
  dependencies: CalculationDependencies,
): Result<readonly string[]> {
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    return failure(errorDiagnostic('graph.invalid', 'Dependencies must be a node record.'));
  }
  const ids = Object.keys(dependencies);
  if (ids.length > 2048) {
    return failure(
      errorDiagnostic('graph.limit', 'A calculation graph may have at most 2048 nodes.'),
    );
  }
  const pending = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  let edges = 0;
  for (const id of ids) {
    const reads = dependencies[id];
    if (Array.isArray(reads) && reads.length > 16_384 - edges) {
      return failure(errorDiagnostic('graph.limit', 'A calculation graph has too many edges.'));
    }
    if (
      id.length === 0 ||
      id.length > 128 ||
      !Array.isArray(reads) ||
      reads.some((read) => typeof read !== 'string' || !Object.hasOwn(dependencies, read)) ||
      new Set(reads).size !== reads.length
    ) {
      return failure(
        errorDiagnostic('graph.invalid', `Node ${id} has malformed or missing dependencies.`),
      );
    }
    edges += reads.length;
    pending.set(id, reads.length);
    for (const read of reads) {
      const consumers = dependents.get(read) ?? [];
      consumers.push(id);
      dependents.set(read, consumers);
    }
  }
  const order = ids.filter((id) => pending.get(id) === 0);
  for (let index = 0; index < order.length; index++) {
    for (const consumer of dependents.get(order[index]!) ?? []) {
      const remaining = pending.get(consumer)! - 1;
      pending.set(consumer, remaining);
      if (remaining === 0) order.push(consumer);
    }
  }
  if (order.length !== ids.length) {
    const blocked = ids.filter((id) => pending.get(id)! > 0);
    return failure(
      errorDiagnostic(
        'graph.feedback-unsupported',
        `Feedback requires an explicitly specified bounded solver; cyclic or feedback-dependent nodes: ${blocked.join(', ')}.`,
      ),
    );
  }
  return success(order);
}
