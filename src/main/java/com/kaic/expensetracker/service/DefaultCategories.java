package com.kaic.expensetracker.service;

import com.kaic.expensetracker.profile.ProfileService;
import com.kaic.expensetracker.repository.CategoryRepository;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

import java.util.Map;

/** Creates a starter set of categories on first run (and for every new profile), named in the app language. */
@Configuration
public class DefaultCategories {

    @Component
    public static class Seeder {

        private static final String[][] DEFAULTS = {
                {"🍽️", "#E57373"}, {"🛒", "#81C784"}, {"🏠", "#64B5F6"}, {"🚌", "#FFB74D"}, {"💊", "#4DB6AC"},
                {"🎮", "#BA68C8"}, {"📚", "#7986CB"}, {"📺", "#F06292"}, {"📈", "#AED581"}, {"💰", "#FFD54F"},
                {"📦", "#A1887F"}
        };
        private static final Map<String, String[]> NAMES = Map.of(
                "pt", new String[]{"Alimentação", "Mercado", "Moradia", "Transporte", "Saúde", "Lazer", "Educação",
                        "Assinaturas", "Investimentos", "Salário", "Outros"},
                "en", new String[]{"Food", "Groceries", "Housing", "Transport", "Health", "Leisure", "Education",
                        "Subscriptions", "Investments", "Salary", "Other"},
                "es", new String[]{"Comida", "Supermercado", "Vivienda", "Transporte", "Salud", "Ocio", "Educación",
                        "Suscripciones", "Inversiones", "Salario", "Otros"});

        private final CategoryRepository repository;
        private final CategoryService service;
        private final ProfileService profiles;

        public Seeder(CategoryRepository repository, CategoryService service, ProfileService profiles) {
            this.repository = repository;
            this.service = service;
            this.profiles = profiles;
        }

        /** Adds the starter categories to the current profile, unless it already has some. */
        public void seed() {
            if (repository.count() > 0) {
                return;
            }
            String[] names = NAMES.getOrDefault(profiles.language(), NAMES.get("pt"));
            for (int i = 0; i < DEFAULTS.length; i++) {
                service.create(names[i], DEFAULTS[i][0], DEFAULTS[i][1]);
            }
        }
    }

    @Bean
    ApplicationRunner seedDefaultCategories(Seeder seeder) {
        return args -> seeder.seed();
    }
}
