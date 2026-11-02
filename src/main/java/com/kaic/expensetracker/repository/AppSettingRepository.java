package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.AppSetting;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AppSettingRepository extends JpaRepository<AppSetting, String> {
}
