/*
 * SPDX-FileCopyrightText: 2024 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */

export class AssertionError extends Error {
    constructor(message: string) {
        super("Assertion error: " + message);
    }
}

export function assertCondition(cond: any, msg: string): asserts cond {
    if (!cond) {
        throw new AssertionError(`Expected 'cond' to be truthy: ${msg}`);
    }
}

export function assertDefined<T>(
    val: T,
    msg: string,
): asserts val is NonNullable<T> {
    if (val === undefined || val === null) {
        throw new AssertionError(
            `Expected 'val' to be defined, but received ${val}: ${msg}`,
        );
    }
}

export function assertEqual<T>(lhs: T, rhs: T, msg: string) {
    if (lhs !== rhs) {
        throw new AssertionError(
            `Expected 'lhs' to equal ${rhs}, but received ${lhs}: ${msg}`,
        );
    }
}

export function assertUnreachable(msg: string): never {
    throw new AssertionError(
        `Reached code that was supposed to be unreachable: ${msg}`,
    );
}
