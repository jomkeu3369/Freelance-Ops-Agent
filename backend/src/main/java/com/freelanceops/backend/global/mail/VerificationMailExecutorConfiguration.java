package com.freelanceops.backend.global.mail;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Configuration
public class VerificationMailExecutorConfiguration {
    /** Bounded and transient: verification secrets never enter a persistent job, response, or log. */
    @Bean(name = "verificationMailExecutor", destroyMethod = "shutdown")
    ExecutorService verificationMailExecutor() {
        return new ThreadPoolExecutor(2, 2, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(100), runnable -> {
            Thread thread = new Thread(runnable, "verification-mail");
            thread.setDaemon(true);
            return thread;
        }, new ThreadPoolExecutor.AbortPolicy());
    }
}
