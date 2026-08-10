/** Bounded retry for Windows filesystem operations interrupted by transient handles. */
export async function retryTransientFilesystem<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try { return await operation(); }
        catch (error) {
            lastError = error;
            const code = (error as NodeJS.ErrnoException).code;
            if (!isTransientFilesystemError(code) || attempt === attempts - 1) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
        }
    }
    throw lastError;
}

export function isTransientFilesystemError(code: string | undefined): boolean {
    return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}
