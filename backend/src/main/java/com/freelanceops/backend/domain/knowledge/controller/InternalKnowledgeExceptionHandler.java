package com.freelanceops.backend.domain.knowledge.controller;

import com.freelanceops.backend.domain.internaltool.controller.InternalToolExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Preserve the shared typed denial contract for this separate internal controller. */
@RestControllerAdvice(assignableTypes = InternalKnowledgeController.class)
public class InternalKnowledgeExceptionHandler extends InternalToolExceptionHandler {
}
