package com.haierag.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Runs side effects (queue pushes, object deletion) only once the surrounding transaction has committed. */
public final class AfterCommit {

    private static final Logger log = LoggerFactory.getLogger(AfterCommit.class);

    private AfterCommit() {
    }

    public static void run(String description, Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    safeRun(description, action);
                }
            });
        } else {
            safeRun(description, action);
        }
    }

    private static void safeRun(String description, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException e) {
            log.warn("After-commit action '{}' failed: {}", description, e.toString());
        }
    }
}
