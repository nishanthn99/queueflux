package io.queueflux.model.scenario;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ServiceTimeModelTest {

    @Test void lognormalFactorySetsDistributionAndParameters() {
        ServiceTimeModel model = ServiceTimeModel.lognormal(100_000, 50_000);
        assertThat(model.distribution()).isEqualTo(ServiceDistribution.LOGNORMAL);
        assertThat(model.meanMicros()).isEqualTo(100_000d);
        assertThat(model.stdDevMicros()).isEqualTo(50_000d);
    }

    @Test void lognormalAcceptsPositiveParameters() {
        assertThatCode(() -> ServiceTimeModel.lognormal(1, 1)).doesNotThrowAnyException();
    }

    @Test void lognormalRejectsNonPositiveMean() {
        assertThatThrownBy(() -> ServiceTimeModel.lognormal(0, 50_000))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("meanMicros");
    }

    @Test void lognormalRejectsNonPositiveStdDev() {
        assertThatThrownBy(() -> ServiceTimeModel.lognormal(100_000, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("stdDevMicros");
    }

    @Test void lognormalRejectsNonFiniteParameters() {
        assertThatThrownBy(() -> ServiceTimeModel.lognormal(Double.NaN, 1))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ServiceTimeModel.lognormal(1, Double.POSITIVE_INFINITY))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void constantFactoryRemainsUnaffected() {
        ServiceTimeModel model = ServiceTimeModel.constant(200_000);
        assertThat(model.distribution()).isEqualTo(ServiceDistribution.CONSTANT);
        assertThat(model.constantMicros()).isEqualTo(200_000L);
    }

    @Test void exponentialFactoryRemainsUnaffected() {
        ServiceTimeModel model = ServiceTimeModel.exponential(100_000);
        assertThat(model.distribution()).isEqualTo(ServiceDistribution.EXPONENTIAL);
        assertThat(model.meanMicros()).isEqualTo(100_000d);
    }
}
