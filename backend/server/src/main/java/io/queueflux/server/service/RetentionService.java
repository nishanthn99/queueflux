package io.queueflux.server.service;

import io.queueflux.server.config.RetentionProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class RetentionService {
    private static final Logger log = LoggerFactory.getLogger(RetentionService.class);

    private final JdbcTemplate jdbc;
    private final RetentionProperties props;

    public RetentionService(JdbcTemplate jdbc, RetentionProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    /**
     * Purges terminal simulation runs older than the configured TTL.
     * The schedule is configurable so deployments can move cleanup away from
     * peak database activity without changing application code.
     */
    @Scheduled(cron = "${app.retention.cleanup-cron:0 0 2 * * *}")
    public void purgeOldRuns() {
        if (props.runTtlDays() == 0) return;

        int deleted = jdbc.update("""
                DELETE FROM simulation_runs
                WHERE completed_at < NOW() - (? * INTERVAL '1 day')
                AND status IN ('COMPLETED', 'FAILED')
                """, props.runTtlDays());

        if (deleted > 0) {
            log.info("Retention: purged {} simulation run(s) older than {} days",
                    deleted, props.runTtlDays());
        }
    }
}
