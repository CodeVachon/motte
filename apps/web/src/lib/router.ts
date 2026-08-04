import { useCallback, useEffect, useState } from "react";

/**
 * Routing, hand-rolled.
 *
 * Four routes and one parameter did not seem worth a router dependency: what follows is small enough to
 * read in one go and to test without a browser, where a library would mostly be configuration. If the view
 * count grows or nested layouts appear, swapping in react-router is a contained change — everything outside
 * this file goes through `useRoute` and `href`.
 *
 * Real paths rather than a hash, because `motte serve` already falls back to the entry document for
 * unrecognised paths, so a deep link like /issues/12 survives a reload.
 */

export type Route =
    | { name: "board" }
    | { name: "tree" }
    | { name: "reports" }
    | { name: "issue"; id: number }
    | { name: "unknown"; path: string };

export function parseRoute(pathname: string): Route {
    // Trailing slashes are equivalent, and a bare "" happens when the pathname is just "/".
    const path = pathname.replace(/\/+$/, "");

    if (path === "" || path === "/board") return { name: "board" };
    if (path === "/tree") return { name: "tree" };
    if (path === "/reports") return { name: "reports" };

    const issue = /^\/issues\/(\d+)$/.exec(path);
    if (issue) return { name: "issue", id: Number(issue[1]) };

    return { name: "unknown", path: pathname };
}

/** The path for a route, so links and navigation cannot disagree about the shape of a URL. */
export function href(route: Route): string {
    switch (route.name) {
        case "board":
            return "/";
        case "tree":
            return "/tree";
        case "reports":
            return "/reports";
        case "issue":
            return `/issues/${route.id}`;
        case "unknown":
            return route.path;
    }
}

/**
 * `pushState` does not fire `popstate`, so navigation within the app would otherwise be invisible to
 * anything listening for history changes.
 */
const NAVIGATED = "motte:navigated";

export function navigate(path: string): void {
    if (path === window.location.pathname) return;

    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event(NAVIGATED));
}

export function useRoute(): Route {
    const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

    const sync = useCallback(() => setRoute(parseRoute(window.location.pathname)), []);

    useEffect(() => {
        // popstate for the back button, the custom event for in-app navigation.
        window.addEventListener("popstate", sync);
        window.addEventListener(NAVIGATED, sync);

        return () => {
            window.removeEventListener("popstate", sync);
            window.removeEventListener(NAVIGATED, sync);
        };
    }, [sync]);

    return route;
}
