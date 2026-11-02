package com.freelanceops.backend.domain.identity.service;

import com.freelanceops.backend.domain.identity.repository.JdbcLoginActivityRepository;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/** 발급한 세션과 함께 로그인 이력을 저장한다. 갱신과 실패한 시도는 제외한다. */
@Service
public class LoginActivityService {
    public enum Method {
        PASSWORD,
        REGISTRATION
    }

    private final JdbcLoginActivityRepository repository;

    public LoginActivityService(JdbcLoginActivityRepository repository) {
        this.repository = repository;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void record(UUID userId, Method method, Instant occurredAt) {
        repository.insertActivity(UUID.randomUUID(), userId, method.name(), occurredAt);
    }
}
