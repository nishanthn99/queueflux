package io.queueflux.engine.runtime;

import io.queueflux.model.scenario.ServiceTimeModel;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ServiceTimeSamplerTest {

    @Test void constantReturnsFixedDuration() {
        ServiceTimeModel model = ServiceTimeModel.constant(200_000);
        assertThat(ServiceTimeSampler.sample(model, 42L, "job-1")).isEqualTo(200_000L);
    }

    @Test void lognormalIsDeterministicForSameSeedAndJob() {
        ServiceTimeModel model = ServiceTimeModel.lognormal(100_000, 50_000);
        long first = ServiceTimeSampler.sample(model, 42L, "job-1");
        long second = ServiceTimeSampler.sample(model, 42L, "job-1");
        assertThat(first).isEqualTo(second);
    }

    @Test void lognormalVariesAcrossJobs() {
        ServiceTimeModel model = ServiceTimeModel.lognormal(100_000, 50_000);
        long a = ServiceTimeSampler.sample(model, 42L, "job-1");
        long b = ServiceTimeSampler.sample(model, 42L, "job-2");
        assertThat(a).isNotEqualTo(b);
    }

    @Test void lognormalAlwaysReturnsPositiveDuration() {
        ServiceTimeModel model = ServiceTimeModel.lognormal(10, 40);
        for (int i = 0; i < 5_000; i++) {
            assertThat(ServiceTimeSampler.sample(model, 7L, "job-" + i)).isGreaterThanOrEqualTo(1L);
        }
    }

    @Test void lognormalReproducesConfiguredMeanAndStdDev() {
        double mean = 100_000d;
        double stdDev = 50_000d;
        ServiceTimeModel model = ServiceTimeModel.lognormal(mean, stdDev);
        int samples = 50_000;

        double sum = 0d;
        double sumSquares = 0d;
        for (int i = 0; i < samples; i++) {
            long value = ServiceTimeSampler.sample(model, 123L, "job-" + i);
            sum += value;
            sumSquares += (double) value * value;
        }
        double empiricalMean = sum / samples;
        double empiricalVariance = sumSquares / samples - empiricalMean * empiricalMean;
        double empiricalStdDev = Math.sqrt(empiricalVariance);

        assertThat(empiricalMean).isCloseTo(mean, org.assertj.core.data.Percentage.withPercentage(3));
        assertThat(empiricalStdDev).isCloseTo(stdDev, org.assertj.core.data.Percentage.withPercentage(12));
    }
}
