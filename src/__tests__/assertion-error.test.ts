/*
 * SPDX-FileCopyrightText: 2026 Adam Platkevič <rflashster@gmail.com>
 *
 * SPDX-License-Identifier: MIT
 */
import { expect, test } from "@jest/globals";

import { AssertionError, assertCondition } from "../assert";

test("AssertionError has name and message prefix", () => {
    try {
        assertCondition(false, "test message");
        throw new Error("Expected assertion to throw");
    } catch (err) {
        const error = err as Error;
        expect(error).toBeInstanceOf(AssertionError);
        expect(error.name).toBe("AssertionError");
        expect(error.message).toContain("Assertion error:");
    }
});
