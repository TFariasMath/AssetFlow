import os
from django.core.management.base import BaseCommand
from django.core.management import call_command
from portfolios.services import etl_import_portfolio_data

class Command(BaseCommand):
    help = "Ejecuta las migraciones e importa los datos de portafolios y precios desde datos.xlsx"

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING("Iniciando migraciones de base de datos..."))
        call_command('migrate')
        self.stdout.write(self.style.SUCCESS("Migraciones completadas."))

        excel_path = 'datos.xlsx'
        if not os.path.exists(excel_path):
            self.stdout.write(self.style.ERROR(f"Error: No se encontró el archivo '{excel_path}' en la raíz del proyecto."))
            return

        self.stdout.write(self.style.WARNING(f"Ejecutando proceso ETL con el archivo '{excel_path}'..."))
        try:
            etl_import_portfolio_data(excel_file_path=excel_path)
            self.stdout.write(self.style.SUCCESS("Proceso ETL completado con éxito. Datos importados."))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error durante el proceso ETL: {str(e)}"))
