package com.kaic.expensetracker.sync;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * When the sync runs by itself: at startup, every 5 minutes, and a few seconds after something is saved (any change
 * request except the sync's own). Does nothing until the person connects to the hub.
 */
@Configuration
@ConditionalOnProperty(name = "app.background-sync", havingValue = "true", matchIfMissing = true)
public class SyncTriggers implements WebMvcConfigurer {

    private final SyncService sync;

    public SyncTriggers(SyncService sync) {
        this.sync = sync;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        sync.notifyChange();
    }

    @Scheduled(fixedDelay = 5 * 60 * 1000L, initialDelay = 5 * 60 * 1000L)
    public void periodic() {
        sync.maybeSync();
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
                boolean change = !request.getMethod().equals("GET") && !request.getMethod().equals("HEAD")
                        && !request.getMethod().equals("OPTIONS");
                if (change && response.getStatus() < 400 && !request.getRequestURI().startsWith("/api/sync")) {
                    sync.notifyChange();
                }
            }
        });
    }
}
