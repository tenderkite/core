type Dependencies = Record<string, string[]>;

export function buildDependency(dependencies: Dependencies): string[][] {
    const result: string[][] = [];
    const visited: Set<string> = new Set();
    const visiting: Set<string> = new Set();

    function dfs(node: string, stack: string[]) {
        if (visiting.has(node)) {
            throw new Error(`Circular dependency detected: ${node}`);
        }

        if (!visited.has(node)) {
            visiting.add(node);

            if (dependencies[node]) {
                //@ts-ignore
                for (const dependency of dependencies[node]) {
                    dfs(dependency, stack);
                }
            }

            stack.push(node);
            visited.add(node);
            visiting.delete(node);
        }
    }

    for (const node in dependencies) {
        if (!visited.has(node)) {
            const stack: string[] = [];
            dfs(node, stack);
            result.push(stack);
        }
    }

    return result
}