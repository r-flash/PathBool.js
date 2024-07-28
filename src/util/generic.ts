/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

export function isNumber(val: unknown): val is number {
    return typeof val === "number";
}

export function isString(val: unknown): val is string {
    return typeof val === "string";
}

export function isBoolean(val: unknown): val is boolean {
    return typeof val === "boolean";
}

export const hasOwn = Object.hasOwn;

export function memoizeWeak<Obj extends Object, Args, Ret>(
    fn: (obj: Obj, ...args: Args[]) => Ret,
) {
    const cache = new WeakMap<Obj, Ret>();
    return (obj: Obj, ...args: Args[]) => {
        if (cache.has(obj)) {
            return cache.get(obj)!;
        } else {
            const val = fn(obj, ...args);
            cache.set(obj, val);
            return val;
        }
    };
}

export function countIf<T>(arr: T[], pred: (value: T) => boolean): number {
    return arr.reduce((acc: number, item: T) => acc + (pred(item) ? 1 : 0), 0);
}
