package com.kaic.expensetracker.profile;

import java.util.function.Supplier;

/** The profile the current thread works on: a request (from its cookie) or a background job. */
public final class ProfileContext {

    public static final String MAIN = "main";

    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private ProfileContext() {
    }

    public static String current() {
        String id = CURRENT.get();
        return id == null ? MAIN : id;
    }

    /** Switches this thread to {@code id}; call {@link #clear()} (in a finally) when done. */
    static void set(String id) {
        CURRENT.set(id);
    }

    static void clear() {
        CURRENT.remove();
    }

    public static void runAs(String id, Runnable action) {
        String before = CURRENT.get();
        CURRENT.set(id);
        try {
            action.run();
        } finally {
            if (before == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(before);
            }
        }
    }

    public static <T> T callAs(String id, Supplier<T> action) {
        Object[] box = new Object[1];
        runAs(id, () -> box[0] = action.get());
        @SuppressWarnings("unchecked") T result = (T) box[0];
        return result;
    }
}
