"use client";

import { RefObject, useEffect } from "react";
import { bindFocusedFieldViewport } from "../../../../app/lib/focused-field-viewport.mjs";

export function useFocusedComposerViewport(input: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    // Include Send and its tools, rather than exposing only the textarea.
    const composer = field.closest(".agent-chat-composer") ?? field;
    return bindFocusedFieldViewport(field, window, composer);
  }, [input]);
}
