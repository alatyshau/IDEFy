import type { Renderer, RendererId, RendererRegistry } from "../types.js";
import { asciiRenderer } from "./ascii.js";

class Registry implements RendererRegistry {
    private readonly map = new Map<RendererId, Renderer>();

    register(renderer: Renderer): void {
        this.map.set(renderer.id, renderer);
    }

    get(id: RendererId): Renderer | null {
        return this.map.get(id) ?? null;
    }

    listAvailable(): readonly RendererId[] {
        return [...this.map.keys()];
    }
}

export function createRendererRegistry(): RendererRegistry {
    const registry = new Registry();
    registry.register(asciiRenderer);
    return registry;
}
