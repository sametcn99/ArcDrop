// JSDOM does not implement cross-tab Web Locks. Queue work by lock name.
const queues = new Map<string, Promise<unknown>>();

Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request<T>(name: string, work: () => T): Promise<T> {
      const task = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(work);
      queues.set(name, task);
      const release = () => {
        if (queues.get(name) === task) queues.delete(name);
      };
      void task.then(release, release);
      return task;
    },
  },
});
