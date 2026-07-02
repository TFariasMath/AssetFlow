from django.db import models
from django.utils import timezone

class BaseModel(models.Model):
    created_at = models.DateTimeField(db_index=True, default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True

# ==========================================
# 1. CAPA BRONZE (Raw Data Ingestion)
# ==========================================

class RawWeightIngestion(BaseModel):
    raw_date = models.CharField(max_length=50)
    raw_asset_name = models.CharField(max_length=100)
    raw_portfolio_1_weight = models.CharField(max_length=50)
    raw_portfolio_2_weight = models.CharField(max_length=50)

    def __str__(self):
        return f"Raw Weight: {self.raw_asset_name} on {self.raw_date}"

class RawPriceIngestion(BaseModel):
    raw_date = models.CharField(max_length=50)
    raw_asset_name = models.CharField(max_length=100)
    raw_price_value = models.CharField(max_length=50)

    def __str__(self):
        return f"Raw Price: {self.raw_asset_name} on {self.raw_date}"

# ==========================================
# 2. CAPA SILVER (Conformed Relational Layer)
# ==========================================

class Asset(BaseModel):
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class Portfolio(BaseModel):
    name = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.name

class Price(BaseModel):
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='prices')
    date = models.DateField(db_index=True)
    price = models.DecimalField(max_digits=18, decimal_places=6)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['asset', 'date'], name='unique_asset_price_per_date')
        ]

    def __str__(self):
        return f"{self.asset.name} - {self.date}: {self.price}"

class PortfolioAssetQuantity(BaseModel):
    portfolio = models.ForeignKey(Portfolio, on_delete=models.CASCADE, related_name='asset_quantities')
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='portfolio_quantities')
    quantity = models.DecimalField(max_digits=24, decimal_places=12)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['portfolio', 'asset'], name='unique_portfolio_asset_quantity')
        ]

    def __str__(self):
        return f"{self.portfolio.name} - {self.asset.name}: {self.quantity}"

# ==========================================
# 3. CAPA GOLD (Aggregated Business Snapshots)
# ==========================================

class PortfolioDailySnapshot(BaseModel):
    portfolio = models.ForeignKey(Portfolio, on_delete=models.CASCADE, related_name='daily_snapshots')
    date = models.DateField(db_index=True)
    total_value = models.DecimalField(max_digits=18, decimal_places=4)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['portfolio', 'date'], name='unique_portfolio_daily_snapshot')
        ]

    def __str__(self):
        return f"{self.portfolio.name} - {self.date}: {self.total_value}"

class PortfolioAssetDailySnapshot(BaseModel):
    portfolio = models.ForeignKey(Portfolio, on_delete=models.CASCADE, related_name='asset_daily_snapshots')
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name='portfolio_daily_snapshots')
    date = models.DateField(db_index=True)
    amount = models.DecimalField(max_digits=18, decimal_places=4)
    weight = models.DecimalField(max_digits=10, decimal_places=6)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['portfolio', 'asset', 'date'], name='unique_portfolio_asset_daily_snapshot')
        ]

    def __str__(self):
        return f"{self.portfolio.name} - {self.asset.name} - {self.date}: {self.weight}"
