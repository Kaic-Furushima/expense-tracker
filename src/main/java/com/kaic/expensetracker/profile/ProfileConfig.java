package com.kaic.expensetracker.profile;

import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

import javax.sql.DataSource;
import java.nio.file.Path;
import java.nio.file.Paths;

/** Wraps the auto-configured data source so each profile gets its own database. */
@Configuration
public class ProfileConfig {

    @Bean
    static BeanPostProcessor profileDataSourcePostProcessor(Environment env) {
        return new BeanPostProcessor() {
            @Override
            public Object postProcessAfterInitialization(Object bean, String beanName) {
                if ("dataSource".equals(beanName) && bean instanceof DataSource ds && !(bean instanceof ProfileDataSource)) {
                    Path root = Paths.get(env.getProperty("app.data-dir", "./data")).toAbsolutePath().normalize();
                    return new ProfileDataSource(ds, root);
                }
                return bean;
            }
        };
    }
}
