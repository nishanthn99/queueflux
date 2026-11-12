package io.queueflux.engine.api;

@FunctionalInterface
public interface SimulationObserver {
    void onProgress(SimulationProgress progress);

    default boolean isCancelled() { return false; }

    static SimulationObserver noop() {
        return ignored -> {};
    }
}
