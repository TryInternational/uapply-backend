from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import json

# Set up Chrome options
chrome_options = Options()
chrome_options.add_argument("--headless")  # Ensure GUI is off
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")

# Set up WebDriver
service = Service(ChromeDriverManager().install())
driver = webdriver.Chrome(service=service, options=chrome_options)

# URL to scrape
url = 'https://www.kaplanpathways.com/degree-finder/#/search-result?status=7&preparation_course_type=10;200&degree_level=10'

# Function to extract course data
def extract_course_data():
    driver.get(url)

    # Increase wait time and check for specific elements
    try:
        WebDriverWait(driver, 30).until(
            EC.presence_of_element_located((By.CLASS_NAME, 'accordion-item'))
        )
    except Exception as e:
        print(f"Error waiting for elements: {e}")
        # Print the page source for debugging
        with open('page_source.html', 'w') as f:
            f.write(driver.page_source)
        return []

    soup = BeautifulSoup(driver.page_source, 'html.parser')
    courses = []

    # Debugging: Print out the page source to verify HTML
    with open('page_source.html', 'w') as f:
        f.write(driver.page_source)

    # Find all course elements
    course_elements = soup.find_all('li', class_='accordion-item degree-item')
    print(f"Found {len(course_elements)} course elements.")  # Debugging line
    
    if not course_elements:
        print("Course elements not found. Please check the class names or HTML structure.")
    
    for course in course_elements:
        try:
            university = course.find('p', class_='university').get_text(strip=True)
            degree_name = course.find('p', class_='degree-name').get_text(strip=True)
            location = course.find('p', class_='location').get_text(strip=True)
            
            # Get detailed information from accordion content
            details = course.find('div', class_='degree-details')
            school = details.find('span', class_='important-info').get_text(strip=True)
            duration = details.find_all('p')[1].find('span', class_='important-info').get_text(strip=True)
            intake = details.find_all('p')[2].find('span', class_='important-info').get_text(strip=True)
            fee = details.find_all('p')[3].find('span', class_='important-info').get_text(strip=True)

            # Append course data
            courses.append({
                
                'university': university,
                'degree_name': degree_name,
                'location': location,
                'school': school,
                'duration': duration,
                'intake': intake,
                'fee': fee
            })
        except Exception as e:
            print(f"Error extracting course data: {e}")
    
    return courses

# Scrape data and save to JSON file
try:
    courses_data = extract_course_data()
    if courses_data:
        with open('courses.json', 'w') as file:
            json.dump(courses_data, file, indent=4)
        print('Data successfully scraped and saved to courses.json.')
    else:
        print('No data found.')
except Exception as e:
    print(f"An error occurred: {e}")
finally:
    driver.quit()
