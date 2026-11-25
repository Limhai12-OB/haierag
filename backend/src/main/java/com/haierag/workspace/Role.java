package com.haierag.workspace;

public enum Role {
    VIEWER(1), MEMBER(2), OWNER(3);

    private final int rank;

    Role(int rank) {
        this.rank = rank;
    }

    public boolean atLeast(Role other) {
        return rank >= other.rank;
    }
}
