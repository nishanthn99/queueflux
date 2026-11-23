package io.queueflux.engine.runtime;

import io.queueflux.engine.random.DeterministicRandom;
import io.queueflux.model.scenario.ServiceDistribution;
import io.queueflux.model.scenario.ServiceTimeModel;

public final class ServiceTimeSampler {
    private ServiceTimeSampler() {}

    public static long sample(ServiceTimeModel model, long seed, String jobId) {
        if (model.distribution() == ServiceDistribution.CONSTANT) return model.constantMicros();
        DeterministicRandom random = DeterministicRandom.stream(seed, "service:" + jobId);
        if (model.distribution() == ServiceDistribution.LOGNORMAL) {
            return sampleLognormal(model, random);
        }
        double uniform = Math.max(Double.MIN_VALUE, 1d - random.nextDouble());
        return Math.max(1L, (long) Math.ceil(-Math.log(uniform) * model.meanMicros()));
    }

    /**
     * Sample a log-normal service time from a single uniform draw. The scenario expresses the
     * distribution through its real-space mean and standard deviation; these are converted to the
     * underlying normal parameters (mu, sigma) so that the sampled values reproduce the requested
     * mean and variance.
     */
    private static long sampleLognormal(ServiceTimeModel model, DeterministicRandom random) {
        double mean = model.meanMicros();
        double stdDev = model.stdDevMicros();
        double variance = stdDev * stdDev;
        double sigmaSquared = Math.log(1d + variance / (mean * mean));
        double sigma = Math.sqrt(sigmaSquared);
        double mu = Math.log(mean) - sigmaSquared / 2d;
        double p = clampProbability(random.nextDouble());
        double z = inverseStandardNormalCdf(p);
        double value = Math.exp(mu + sigma * z);
        if (!Double.isFinite(value)) return Long.MAX_VALUE;
        return Math.max(1L, Math.round(value));
    }

    /** Keep the probability strictly inside (0, 1) so the inverse CDF stays finite. */
    private static double clampProbability(double uniform) {
        double p = 1d - uniform;
        if (p <= 0d) return Double.MIN_VALUE;
        if (p >= 1d) return Math.nextDown(1d);
        return p;
    }

    private static final double P_LOW = 0.02425d;
    private static final double P_HIGH = 1d - P_LOW;

    private static final double[] A = {
        -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
        1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00
    };
    private static final double[] B = {
        -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
        6.680131188771972e+01, -1.328068155288572e+01
    };
    private static final double[] C = {
        -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
        -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00
    };
    private static final double[] D = {
        7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00
    };

    /**
     * Inverse of the standard normal cumulative distribution function using Acklam's rational
     * approximation. Deterministic and pure, so repeated runs with the same seed are reproducible.
     */
    private static double inverseStandardNormalCdf(double p) {
        if (p < P_LOW) {
            double q = Math.sqrt(-2d * Math.log(p));
            return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
                / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1d);
        }
        if (p <= P_HIGH) {
            double q = p - 0.5d;
            double r = q * q;
            return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
                / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1d);
        }
        double q = Math.sqrt(-2d * Math.log(1d - p));
        return -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1d);
    }
}
