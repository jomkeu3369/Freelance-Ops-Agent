package com.freelanceops.backend.global.mail;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Configuration
public class VerificationMailExecutorConfiguration {
    /** 크기가 제한된 메모리 대기열을 사용하며 인증 정보를 작업 저장소·응답·로그에 남기지 않는다. */
    @Bean(name = "verificationMailExecutor", destroyMethod = "shutdown")
    ExecutorService verificationMailExecutor() {
        return new ThreadPoolExecutor(
                2,
                2,
                30,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(100),
                runnable -> {
                    Thread thread = new Thread(runnable, "verification-mail");
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy());
    }
}
