// Plain fetch handlers are used in production. The OAuth library only needs this
// marker class to distinguish them from WorkerEntrypoint constructors in Node tests.
export class WorkerEntrypoint {}
