package io.queueflux.model.scenario;

/** Service times are expressed in microseconds. */
public record ServiceTimeModel(ServiceDistribution distribution, long constantMicros, double meanMicros,
                               double stdDevMicros) {
    public ServiceTimeModel {
        if (distribution == null) throw new IllegalArgumentException("service distribution is required");
        if (distribution == ServiceDistribution.CONSTANT && constantMicros <= 0) {
            throw new IllegalArgumentException("constantMicros must be > 0");
        }
        if (distribution == ServiceDistribution.EXPONENTIAL && (!Double.isFinite(meanMicros) || meanMicros <= 0)) {
            throw new IllegalArgumentException("meanMicros must be finite and > 0");
        }
        if (distribution == ServiceDistribution.LOGNORMAL) {
            if (!Double.isFinite(meanMicros) || meanMicros <= 0) {
                throw new IllegalArgumentException("meanMicros must be finite and > 0");
            }
            if (!Double.isFinite(stdDevMicros) || stdDevMicros <= 0) {
                throw new IllegalArgumentException("stdDevMicros must be finite and > 0");
            }
        }
    }

    public static ServiceTimeModel constant(long micros) {
        return new ServiceTimeModel(ServiceDistribution.CONSTANT, micros, micros, 0);
    }

    public static ServiceTimeModel exponential(double meanMicros) {
        return new ServiceTimeModel(ServiceDistribution.EXPONENTIAL, 0, meanMicros, 0);
    }

    public static ServiceTimeModel lognormal(double meanMicros, double stdDevMicros) {
        return new ServiceTimeModel(ServiceDistribution.LOGNORMAL, 0, meanMicros, stdDevMicros);
    }
}
