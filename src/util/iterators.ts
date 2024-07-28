/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

export function* map<T1, T2>(
    iter: Iterable<T1>,
    fn: (val: T1, index: number) => T2,
): Iterable<T2> {
    let i = 0;
    for (const val of iter) {
        yield fn(val, i++);
    }
}

export function* flatMap<T1, T2>(
    iter: Iterable<T1>,
    fn: (val: T1, index: number) => Iterable<T2>,
): Iterable<T2> {
    let i = 0;
    for (const val of iter) {
        yield* fn(val, i++);
    }
}

export function* filter<T>(
    iter: Iterable<T>,
    fn: (val: T) => boolean,
): Iterable<T> {
    for (const val of iter) {
        if (fn(val)) {
            yield val;
        }
    }
}
