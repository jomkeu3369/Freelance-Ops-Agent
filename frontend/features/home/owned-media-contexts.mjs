/** Own native media listeners as well as the animations created for each match. */
export function createOwnedMediaContexts(gsap, mediaOwner, scope) {
  const cleanups = new Set();
  let reverted = false;
  const owner = {
    add(query, setup) {
      if (reverted) return owner;
      const media = mediaOwner.matchMedia(query);
      let context;
      let disposed = false;
      const sync = () => {
        if (disposed) return;
        if (media.matches) {
          if (!context) context = gsap.context(setup, scope);
        } else {
          context?.revert();
          context = undefined;
        }
      };
      const cleanup = () => {
        if (disposed) return;
        disposed = true;
        media.removeEventListener("change", sync);
        context?.revert();
        context = undefined;
      };
      cleanups.add(cleanup);
      media.addEventListener("change", sync);
      try {
        sync();
      } catch (error) {
        cleanup();
        cleanups.delete(cleanup);
        throw error;
      }
      return owner;
    },
    revert() {
      if (reverted) return;
      reverted = true;
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
    },
  };
  return owner;
}
